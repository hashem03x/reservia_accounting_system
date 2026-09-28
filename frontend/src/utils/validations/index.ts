const EMAIL_PART_REGEX = /[a-zA-Z_\d]([a-zA-Z_\d.-]*[a-zA-Z_\d])?/;

export const validationRegex = {
  name: /^[^0-9 !@#$%^&*()_+\-={}[\]\\|'";:/?.>,<].*/,
  email: new RegExp(`^${EMAIL_PART_REGEX.source}@${EMAIL_PART_REGEX.source}\\.[a-zA-Z0-9]{2,}$`),
  phone: /^01[0125][0-9]{8}$/,
  password: /^.{8,}$/,
};
