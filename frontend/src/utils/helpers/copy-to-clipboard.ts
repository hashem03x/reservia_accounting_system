export default async function copyToClipboard(textToCopy: string, setCopied: React.Dispatch<React.SetStateAction<boolean>>) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  } else {
    console.log("Clipboard API not supported in this browser.");
    copyToClipboardFallback(textToCopy, setCopied);
  }
}

function copyToClipboardFallback(textToCopy: string, setCopied: React.Dispatch<React.SetStateAction<boolean>>) {
  const textArea = document.createElement("textarea");
  textArea.value = textToCopy;
  textArea.style.position = "fixed"; // Prevent scrolling to bottom of page in MS Edge.
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const successful = document.execCommand("copy");
    const msg = successful ? "successful" : "unsuccessful";
    console.log("Fallback: Copying text command was " + msg);
    setCopied(successful);
  } catch (err) {
    console.error("Fallback: Oops, unable to copy", err);
    alert("Copying failed. Please try again.");
  }
  document.body.removeChild(textArea);
  setTimeout(() => setCopied(false), 1000);
}
