import { NewTabFileSearch, type NewTabFileSearchProps } from "./NewTabFileSearch";

export type NewTabPageProps = NewTabFileSearchProps;

/**
 * Browser-style "New Tab" landing page for the secondary panel. Today its only
 * capability is file search, but it is structured as a page that hosts sections
 * so future entry points (e.g. open a terminal, quick links) can be added
 * alongside the search without reshaping the tab.
 */
export function NewTabPage(props: NewTabPageProps) {
  return (
    <div className="flex min-h-full flex-col gap-3 px-4 pt-1">
      <NewTabFileSearch {...props} />
    </div>
  );
}
