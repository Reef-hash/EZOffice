// Ambient typing for pdfmake's bundled font config — not covered by @types/pdfmake,
// which only types the package's main entry and build/ subpaths.
declare module 'pdfmake/fonts/Roboto.js' {
  interface RobotoFontFamily {
    normal: string
    bold: string
    italics: string
    bolditalics: string
  }
  const fonts: { Roboto: RobotoFontFamily }
  export default fonts
}
