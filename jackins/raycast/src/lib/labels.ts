/** The model's label with a note when prompts leave the machine. */
export function whereLabel(navi: { label: string; local: boolean }): string {
  return navi.local ? navi.label : `${navi.label} (remote)`
}
