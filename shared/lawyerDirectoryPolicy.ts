// Public visibility of the lawyer directory. While false, no listing is shown to the public: search returns nothing,
// profile lookups return nothing, and the page explains the pause. The data, the code and the verification pipeline
// are untouched; set this to true only after every listing has been verified against its source.
export const PUBLIC_DIRECTORY_VISIBLE = false;

export const DIRECTORY_PAUSED_MESSAGE =
  "The lawyer directory is paused while listings are verified. For a referral now, contact Legal Aid Ontario at 1-800-668-8258.";
