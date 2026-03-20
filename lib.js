function encodeToVariableName(str) {
  const symbolMap = {
    '-': '_dash_',
    '.': '_dot_',
    '@': '_at_',
    ' ': '_',
    '!': '_excl_',
    '+': '_plus_',
    '=': '_eq_'
  };

  const reservedWords = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'enum', 'await']);

  let result = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    const isFirst = i === 0;
    const regex = isFirst ? /^[\p{ID_Start}_$]$/u : /^[\p{ID_Continue}$]$/u;

    if (regex.test(char)) {
      result += char;
    } else if (symbolMap[char]) {
      result += symbolMap[char];
    } else {
      const hex = char.charCodeAt(0).toString(16).toUpperCase();
      result += `_u${hex}_`;
    }
  }

  if (/^[0-9]/.test(result)) {
    result = '_' + result;
  }

  if (reservedWords.has(result)) {
    result += '_';
  }

  return result;
}