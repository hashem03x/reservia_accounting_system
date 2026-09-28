import { useRef } from "react";
import { Button, Menu } from "@mantine/core";

export default function PrintDocument({
  title,
  children,
  paperWidth,
  paperHeight,
  paperMarginX = 10,
  paperMarginY = 15,
  icon = null,
  buttonType = "Menu",
}: {
  title: string;
  children: React.ReactNode;
  paperWidth: number;
  paperHeight: number;
  paperMarginX?: number;
  paperMarginY?: number;
  icon?: React.ReactNode;
  buttonType?: "Menu" | "Button" | "Icon";
}) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (printRef.current) {
      const printContent = printRef.current.innerHTML;
      const printWindow = window.open("", "_blank");
      const windowHTML = `
        <html>
          <head>
            <title>${title}</title>
            <style>
              * { box-sizing: border-box; margin: 0; padding: 0; }
              body { display: none; }
              @media print {
                @page { margin: ${paperMarginY}mm ${paperMarginX}mm; size: ${paperWidth}mm ${paperHeight}mm; } 
                body { font-family: Arial, sans-serif; display: block; } 
              }
            </style>
          </head>
          <body onload="window.print(); window.close()">
            ${printContent}
          </body>
        </html>
      `;
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(windowHTML);
        printWindow.document.close();
      }
    }
  };

  return (
    <>
      {buttonType === "Menu" ? (
        <Menu.Item onClick={handlePrint} leftSection={icon}>
          {title}
        </Menu.Item>
      ) : buttonType === "Button" ? (
        <Button onClick={handlePrint} leftSection={icon} color="dark" variant="light" radius="md">
          {title}
        </Button>
      ) : (
        <Button onClick={handlePrint} variant="transparent" title={title} size="xs" px={3}>
          {icon}
        </Button>
      )}

      <div ref={printRef} className="hidden">
        {children}
      </div>
    </>
  );
}
