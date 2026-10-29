/**
 * Pages that open in their own tab, without the app's sidebar: the link
 * editor (the whole window is the form and the phone) and Research & Pattern.
 */
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
