/**
 * The editor opens in its own tab, without the app's sidebar: the whole
 * window is the form and the phone.
 */
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
