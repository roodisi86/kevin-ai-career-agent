import { nl, type Dictionary } from "./nl";

export type { Dictionary };

/** Returns the UI dictionary. Only Dutch for now; the shape is locale-ready. */
export function getDictionary(): Dictionary {
  return nl;
}
