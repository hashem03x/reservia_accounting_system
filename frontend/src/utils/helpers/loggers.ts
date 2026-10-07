export function logRender(componentName: string, dataObject?: Record<string, any>) {
  console.log(`%c\`${componentName}\` Rendered`, "color: green; font-weight: bold;", dataObject ? dataObject : "");
}

export function logError(functionName: string, error?: any) {
  console.log(`%c\`${functionName}\` Error`, "color: red; font-weight: bold;", error ? error : "");
}
