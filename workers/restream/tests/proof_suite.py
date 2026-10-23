"""Named sanitized deterministic test results, without assertion/provider text."""
import json
from pathlib import Path
import sys
import unittest
import workers.restream
sys.path.insert(0, str(Path(__file__).parent))
class Result(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.outcomes = []
    def addSuccess(self, test):
        super().addSuccess(test)
        self.outcomes.append({'test': test.id(), 'outcome': 'passed'})
    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.outcomes.append({'test': test.id(), 'outcome': 'failed', 'type': err[0].__name__})
    def addError(self, test, err):
        super().addError(test, err)
        self.outcomes.append({'test': test.id(), 'outcome': 'error', 'type': err[0].__name__})
    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.outcomes.append({'test': test.id(), 'outcome': 'skipped'})
    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self.outcomes.append({'test': test.id(), 'outcome': 'expected_failure'})
result = Result()
unittest.defaultTestLoader.loadTestsFromNames(sys.argv[1:]).run(result)
print(json.dumps({'testsRun': result.testsRun, 'outcomes': result.outcomes, 'passed': result.wasSuccessful() and not result.skipped and not result.expectedFailures}))
# The parent preserves this JSON even on failure, then rejects passed:false.
