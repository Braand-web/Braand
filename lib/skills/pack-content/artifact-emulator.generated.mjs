// Generated manifest members only; payloads remain in private R2.
import {loadPackedReference} from "../pack-storage.mjs";
export const files = {
  "SKILL.md": {
    "sha256": "c1d237cd1a2d29af7bc220957c08298a5891d8bb64f236a2e9537aeae925b41f",
    "bytes": 1570,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/711812aba011/SKILL.md": {
    "sha256": "abd3dd7fc47ec78900c29f45a36a1ef0b3e0220c53887d7920a32d58b7085e45",
    "bytes": 3329,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/711812aba011/scripts/run_artifact.py": {
    "sha256": "31787aea868a1fe5964fe1278ce8c260674d189dd021863baa7b3de4ae9bff07",
    "bytes": 6198,
    "text": true,
    "mime": "text/x-python"
  }
};
export const load = (reference,storage) => loadPackedReference("artifact-emulator",files,reference,storage);
