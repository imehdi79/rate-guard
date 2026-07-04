import './global.css';

export const metadata = {
  title: 'rate-guard · dashboard',
  description: 'Live tenant quota usage and rate limit violations',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
