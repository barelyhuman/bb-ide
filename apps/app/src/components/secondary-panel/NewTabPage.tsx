import {
  NewTabFileSearch,
  type NewTabFileSearchProps,
} from "./NewTabFileSearch";

export type NewTabPageProps = NewTabFileSearchProps;

/**
 * Browser-style "New Tab" landing page for the secondary panel. The tab body
 * is the in-place file search surface; the panel `+` menu owns app/create and
 * open actions.
 */
export function NewTabPage(props: NewTabPageProps) {
  return (
    <div className="flex min-h-full flex-col gap-3 px-4 pt-1">
      <NewTabFileSearch {...props} />
    </div>
  );
}
