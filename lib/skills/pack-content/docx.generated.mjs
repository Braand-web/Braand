// Generated manifest members only; payloads remain in private R2.
import {loadPackedReference} from "../pack-storage.mjs";
export const files = {
  "SKILL.md": {
    "sha256": "7d67daedfef6d5efa14370799c0c9f4c3a61907bf6801922b0220542e7fe7c47",
    "bytes": 1555,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/2a8c3b60db95/SKILL.md": {
    "sha256": "7629f1a04d676afaa831149e517428e0c888378088a344b72c1ba3c307d27266",
    "bytes": 4834,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/2a8c3b60db95/scripts/docx_dump.py": {
    "sha256": "14496cf8ed31f989283e0b1e24270b520b5bfd044eda14edd4a3d1ba57a77f9f",
    "bytes": 2588,
    "text": true,
    "mime": "text/x-python"
  },
  "imports/2a8c3b60db95/scripts/render_preview.sh": {
    "sha256": "cffcbb07566593d57d1f87d1c75365b1a26475701dec2be3e34250127d450ced",
    "bytes": 448,
    "text": true,
    "mime": "application/x-sh"
  }
};
export const load = (reference,storage) => loadPackedReference("docx",files,reference,storage);
