// Generated manifest members only; payloads remain in private R2.
import {loadPackedReference} from "../pack-storage.mjs";
export const files = {
  "SKILL.md": {
    "sha256": "f2f22f7eda63de6b150720c61ddcda270b5610dde3e6ba2eeffad8c60fa87651",
    "bytes": 1521,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/c3ef1774f9ee/SKILL.md": {
    "sha256": "4b397c1f29e22d64d174150487bb8f57ee9d080d3b600d1291a813736f7b6646",
    "bytes": 4639,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/c3ef1774f9ee/scripts/recalc.sh": {
    "sha256": "60e32b9325478dc2107493704e6075a07bfc0f7dba870358502f0d9d90a81a4f",
    "bytes": 436,
    "text": true,
    "mime": "application/x-sh"
  },
  "imports/c3ef1774f9ee/scripts/render_preview.sh": {
    "sha256": "cffcbb07566593d57d1f87d1c75365b1a26475701dec2be3e34250127d450ced",
    "bytes": 448,
    "text": true,
    "mime": "application/x-sh"
  },
  "imports/c3ef1774f9ee/scripts/xlsx_audit.py": {
    "sha256": "1f5cb444c78a953037a6262868e17063fe20623b50ce5786de63e6a5c48bc7ad",
    "bytes": 1929,
    "text": true,
    "mime": "text/x-python"
  }
};
export const load = (reference,storage) => loadPackedReference("xlsx",files,reference,storage);
