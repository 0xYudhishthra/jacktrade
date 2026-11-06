const darkColors = {
  '#171923':'#e6edf7', '#242936':'#c1d5ef', '#687080':'#9aaabe', '#858b98':'#8294ac',
  '#254a87':'#9fc5ff', '#ffffff':'#172130', '#fffffff2':'#172130f2',
  'rgba(255, 255, 255, 0.98)':'rgba(23,33,48,.98)',
  'rgba(255, 255, 255, 0.97)':'rgba(23,33,48,.97)',
  'rgba(37, 74, 135, 0.2)':'rgba(159,197,255,.3)',
  'rgba(36,41,54,.035)':'rgba(159,197,255,.05)',
};
export function chartColor(value, theme) { return theme === 'dark' ? darkColors[value] || value : value; }
