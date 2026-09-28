export function rememberUser() {
  localStorage.setItem("remember", "true");
}

export function forgetUser() {
  localStorage.removeItem("remember");
}
