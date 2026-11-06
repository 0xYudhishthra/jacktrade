// Dark canvas palette for the charts: ivory ink and warm greys on near-black.
const darkColors = {
  '#171923':'#ece8df', '#242936':'#c9c4b9', '#687080':'#8d887e', '#858b98':'#8d887e',
  '#254a87':'#e9e4d8', '#ffffff':'#0a0a0a', '#fffffff2':'#0a0a0af2',
  'rgba(255, 255, 255, 0.98)':'rgba(14,14,13,.98)',
  'rgba(255, 255, 255, 0.97)':'rgba(14,14,13,.97)',
  'rgba(37, 74, 135, 0.2)':'rgba(233,228,216,.25)',
  'rgba(37, 74, 135, 0.035)':'rgba(233,228,216,.018)',
  'rgba(36,41,54,.035)':'rgba(233,228,216,.04)',
  'rgba(36, 41, 54, 0.035)':'rgba(233,228,216,.04)',
  'rgba(104, 112, 128, 0.10)':'rgba(233,228,216,.06)',
  'rgba(104, 112, 128, 0.35)':'rgba(233,228,216,.25)',
  'rgba(157, 145, 174, 0.14)':'rgba(233,228,216,.06)',
  'rgba(132, 118, 157, 0.22)':'rgba(233,228,216,.16)',
  'rgba(170, 141, 213, 0.7)':'rgba(233,228,216,.6)',
  'rgba(197, 186, 214, 0.5)':'rgba(233,228,216,.35)',
};
export function chartColor(value, theme) { return theme === 'dark' ? darkColors[value] || value : value; }
