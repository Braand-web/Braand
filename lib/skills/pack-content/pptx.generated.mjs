// Generated manifest members only; payloads remain in private R2.
import {loadPackedReference} from "../pack-storage.mjs";
export const files = {
  "SKILL.md": {
    "sha256": "63040a89b3e7b2ae394927ac6db9da1bc53991291e0f4e1bf6e6beb47899292c",
    "bytes": 1444,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/e9f1cbd22cc9/SKILL.md": {
    "sha256": "fcb5a004d8a673531dbafec32b1a8849c0ebc739191591cd9e596580d5794801",
    "bytes": 3797,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/e9f1cbd22cc9/scripts/pptx_dump.py": {
    "sha256": "f22a80c16bec1495aa4059af88d2df7df3258a52852d73eae222c766c6de4f88",
    "bytes": 1924,
    "text": true,
    "mime": "text/x-python"
  },
  "imports/e9f1cbd22cc9/scripts/render_preview.sh": {
    "sha256": "cffcbb07566593d57d1f87d1c75365b1a26475701dec2be3e34250127d450ced",
    "bytes": 448,
    "text": true,
    "mime": "application/x-sh"
  }
};
export const load = (reference,storage) => loadPackedReference("pptx",files,reference,storage);
