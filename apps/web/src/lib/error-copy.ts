/**
 * The last thing a form says when it cannot explain what went wrong.
 *
 * Every write form reaches this: the error was not a structured refusal it
 * knows how to relay, and it matched none of the messages that surface path
 * allows through. What is left is a backend that did not answer, or answered in
 * a way nothing here can turn into an instruction, and neither gives the person
 * anything to act on beyond waiting.
 *
 * One string rather than one per form. Three forms carried their own spelling of
 * the same sentence, so correcting the wording in the one being worked on left
 * the other two saying something else, which is the state this file exists to
 * end. Their surrounding logic still differs, and should: they trust different
 * structured codes and allow different messages through. Only the sentence at
 * the bottom of all three was ever the same thing said three times.
 *
 * The per-form prefixes went with it. "Event save failed" and "Profile
 * submission failed" told a person what they had just pressed, which they know.
 *
 * Deliberately not a translation layer. Sharing the string is what makes one
 * later possible -- a catalog cannot key on a sentence that three files spell
 * differently -- but nothing here loads a locale or picks one.
 */
export const BACKEND_ERROR_COPY = "Backend error - please try again later";
