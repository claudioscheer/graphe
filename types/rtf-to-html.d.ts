declare module '@iarna/rtf-to-html' {
  interface RtfToHtmlApi {
    fromString(rtf: string, callback: (err: Error | null, html: string) => void): void;
  }

  const rtfToHTML: RtfToHtmlApi;
  export default rtfToHTML;
}
