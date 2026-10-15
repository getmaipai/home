// The site opens on the User guide front door.
export default function Page() {
  return (
    <>
      <meta httpEquiv="refresh" content="0; url=/docs/user/" />
      <p style={{ padding: 24 }}>
        <a href="/docs/user/">Open the documentation</a>
      </p>
    </>
  );
}
