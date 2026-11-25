/** React 19 hoists <title>/<meta>/<link> into <head>. */
export function Seo({ title, description, path, jsonLd }: { title: string; description?: string; path?: string; jsonLd?: object }) {
  const full = title.includes("Smile Dental Care") ? title : `${title} | Smile Dental Care`;
  const url = path ? new URL(path, window.location.origin).href : undefined;
  return (
    <>
      <title>{full}</title>
      {description && <meta name="description" content={description} />}
      <meta property="og:title" content={full} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:type" content="website" />
      {url && <link rel="canonical" href={url} />}
      {jsonLd && <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>}
    </>
  );
}
