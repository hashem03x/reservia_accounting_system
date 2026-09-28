const colorMapping = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  orange: '#FFA500',
  purple: '#800080',
  pink: '#FFC0CB',
  brown: '#A52A2A',
  gray: '#808080',
  beige: '#F5F5DC',
  gold: '#FFD700',
  silver: '#C0C0C0',
  navy: '#000080',
  olive: '#808000',
  maroon: '#800000',
  teal: '#008080',
  khaki: '#F0E68C',
  cream: '#FFFDD0',
};

const colors = Object.keys(colorMapping);

module.exports = {
  colors,
  colorMapping,
  getColorCode: color => {
    const normalizedColor = color.toLowerCase();
    return colorMapping[normalizedColor] || null;
  },
};
