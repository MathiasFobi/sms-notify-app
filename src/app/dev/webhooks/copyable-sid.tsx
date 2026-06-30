import CopyableSidButton from "./_components/copyable-sid-button";

/**
 * `CopyableSid` — small wrapper that renders the
 * `<CopyableSidButton>` client island with the inbound `value`.
 * Kept as its own file (rather than inline in `page.tsx`) so the
 * server-component import graph stays small.
 */
export default function CopyableSid({ value }: { value: string }) {
  return <CopyableSidButton value={value} />;
}
