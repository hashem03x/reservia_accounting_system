import React, { useRef, useState } from "react";
import { Alert, Tooltip } from "@mantine/core";
import { solidIcons, outlineIcons } from "@/components/icons";
import { useLanguage } from "@/context/LanguageContext";
import Img from "@/components/ui/img";

const allowedTypes = ["image/png", "image/jpeg"];
const typesErrMsg = { en: "File type must be PNG or JPEG.", ar: "يجب أن يكون نوع الملف PNG أو JPEG." };
const inputAccept = ".png, .jpeg, .jpg";

type ImgControllerProps = {
  image: File | string | null; // string for the URL
  setImage: React.Dispatch<React.SetStateAction<File | string | null>>;
  mini?: boolean;
  placeholder?: string;
  tooltipLabel?: string;
  onClickOnImage?: () => void;
  style?: React.CSSProperties;
  className?: string;
};

export default function ImgController({
  image,
  setImage,
  mini = false,
  placeholder,
  tooltipLabel,
  onClickOnImage,
  style,
  className = "",
}: ImgControllerProps) {
  const { translate } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleUpload(e);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  if (!placeholder) placeholder = translate("Click or drag to add an image", "اختر أو اسحب صورة للتحميل");
  if (!tooltipLabel) tooltipLabel = translate("Remove Image", "ازالة الصورة");

  function handleUpload(e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) {
    setError("");
    let files: File[] = [];

    // Handle Events (Capture the files)
    if (e.type === "drop") files = Array.from((e as React.DragEvent<HTMLDivElement>).dataTransfer.files);
    else files = Array.from((e as React.ChangeEvent<HTMLInputElement>).target.files || []);

    const file = files[0]; // Get the first file only

    // Check if the file type is allowed
    if (isAllowedType(file)) setImage(file);
    else setError(translate(typesErrMsg.en, typesErrMsg.ar));
  }

  return (
    <div className="flex flex-col">
      {image ? (
        <Tooltip.Floating label={tooltipLabel}>
          <div
            className={`cursor-pointer overflow-hidden transition-opacity hover:opacity-80 ${className}`}
            onClick={onClickOnImage || (() => setImage(null))}
            style={style}
          >
            <Img
              width="100%"
              height="100%"
              src={typeof image === "string" ? image : URL.createObjectURL(image)}
              alt={typeof image === "string" ? image : image.name}
              className="rounded-md"
            />
          </div>
        </Tooltip.Floating>
      ) : (
        <div
          title={placeholder}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`flex-center cursor-pointer flex-col gap-2 rounded-lg border border-dashed text-gray-500 transition-colors hover:bg-gray-50 ${dragging ? "border-blue-300 bg-blue-50" : "border-gray-300"} ${className}`}
          style={style}
        >
          <input type="file" ref={inputRef} accept={inputAccept} onChange={handleUpload} hidden />
          {mini ? (
            <solidIcons.Plus className="h-6 w-6" />
          ) : (
            <>
              <outlineIcons.Photo className="h-12 w-12" />
              <p>{placeholder}</p>
            </>
          )}
        </div>
      )}

      {error && (
        <Alert color="red" mt={5} icon={mini ? null : <solidIcons.ExclamationCircle />}>
          {error}
        </Alert>
      )}
    </div>
  );
}

// =============================================================

function isAllowedType(file: File) {
  return allowedTypes.includes(file.type);
}

// Inhance the component by handling the image size and adding a prop to set the maximum size
