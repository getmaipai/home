// The site opens on the User guide front door.
const base = process.env.DOCS_BASE_PATH ?? "";

export default function Page() {
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${base}/docs/user`} />
      <p style={{ padding: 24 }}>
        <a href={`${base}/docs/user`}>Open the documentation</a>
      </p>
    </>
  );
}
