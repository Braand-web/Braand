// Generated manifest members only; payloads remain in private R2.
import {loadPackedReference} from "../pack-storage.mjs";
export const files = {
  "SKILL.md": {
    "sha256": "8cb11b3b6ea678046bc210c1e922bacccd569e52bcbd0ffa9fa99eb8c588c650",
    "bytes": 1509,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/66c6574af8f4/SKILL.md": {
    "sha256": "150418544e6c95b17a69026f8f7047de9f23245651a38712370c24adb5e7309f",
    "bytes": 3011,
    "text": true,
    "mime": "text/markdown"
  },
  "imports/66c6574af8f4/scripts/inventory.py": {
    "sha256": "88afb55c9aee14d1b85fd0e35fc1897281d78b715ce2517d40287db73adc1225",
    "bytes": 5321,
    "text": true,
    "mime": "text/x-python"
  }
};
export const load = (reference,storage) => loadPackedReference("file-reading",files,reference,storage);
