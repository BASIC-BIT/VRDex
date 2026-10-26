"""Bounded named results; raw test/subprocess stdout and stderr never escape."""
import json
import os
from pathlib import Path
import re
import sys
import unittest
import workers.restream

sys.path.insert(0, str(Path(__file__).parent))


class Result(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.outcomes = []
        self.current = None

    def startTest(self, test):
        super().startTest(test)
        self.current = {'test': test.id(), 'outcome': 'error'}
        if not re.fullmatch(r'[A-Za-z0-9_.]{1,200}', test.id()):
            self.current['test'] = 'invalid_test_identifier'
            self.stop()

    def stopTest(self, test):
        super().stopTest(test)
        self.outcomes.append(self.current)
        self.current = None
        if len(self.outcomes) >= 256:
            self.stop()

    def outcome(self, value, err=None):
        self.current['outcome'] = value
        if err:
            name = err[0].__name__
            self.current['type'] = name if re.fullmatch(r'[A-Za-z0-9_]{1,80}', name) else 'Exception'

    def addSuccess(self, test):
        super().addSuccess(test)
        self.outcome('passed')

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.outcome('failed', err)

    def addError(self, test, err):
        outside_test = self.current is None
        if outside_test:
            self.startTest(test)
        super().addError(test, err)
        self.outcome('error', err)
        if outside_test:
            self.stopTest(test)

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err:
            self.outcome('failed', err)

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.outcome('skipped')

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self.outcome('expected_failure')

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self.outcome('unexpected_success')


def main():
    result = Result()
    # FD-level redirection also covers os.write and inherited subprocess output.
    # /dev/null consumes no unbounded buffer; only the bounded typed summary exits.
    sys.stdout.flush()
    sys.stderr.flush()
    saved = [os.dup(1), os.dup(2)]
    try:
        with open(os.devnull, 'w') as sink:
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)
            unittest.defaultTestLoader.loadTestsFromNames(sys.argv[1:]).run(result)
            sys.stdout.flush()
            sys.stderr.flush()
    finally:
        for target, source in zip((1, 2), saved):
            os.dup2(source, target)
            os.close(source)
    print(json.dumps({
        'testsRun': result.testsRun, 'outcomes': result.outcomes,
        'passed': bool(result.testsRun) and not result.shouldStop and result.wasSuccessful()
        and all(row['outcome'] == 'passed' for row in result.outcomes),
    }))


if __name__ == '__main__':
    main()
