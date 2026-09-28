import { useRef, useState } from "react";
import { Alert, Tooltip } from "@mantine/core";
import { UploadedImage } from "@/types/global";
import { solidIcons, outlineIcons } from "@/components/icons";
import { useLanguage } from "@/context/LanguageContext";
import Img from "@/components/ui/img";

const allowedTypes = ["image/png", "image/jpeg", "image/avif", "image/webp"];
const typesErrMsg = {
  en: "File type must be PNG, JPEG, AVIF, or WebP.",
  ar: "يجب أن يكون نوع الملف PNG أو JPEG أو AVIF أو WebP.",
};
const inputAccept = ".png, .jpeg, .jpg, .avif, .webp";

type ImgControllerProps = {
  images: (UploadedImage | File)[];
  setImages: React.Dispatch<React.SetStateAction<(UploadedImage | File)[]>>;
  maxImages?: number;
  mini?: boolean;
  placeholder?: string;
  tooltipLabel?: string;
  onClickOnImage?: (imageIndex: number) => void;
  style?: React.CSSProperties;
  className?: string;
};

export default function MultiImgsController({
  images,
  setImages,
  maxImages = 5,
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

    const filteredFiles = files.filter((file) => isAllowedType(file));
    if (filteredFiles.length === 0) setError(translate(typesErrMsg.en, typesErrMsg.ar));
    else setImages([...images, ...filteredFiles].slice(0, maxImages));
  }

  return (
    <div className="flex flex-col">
      <div className="flex gap-2">
        {images.map((image, imageIndex) => (
          <Tooltip.Floating key={imageIndex} label={tooltipLabel}>
            <div
              className={`cursor-pointer overflow-hidden transition-opacity hover:opacity-80 ${className}`}
              onClick={
                onClickOnImage
                  ? () => onClickOnImage(imageIndex)
                  : () => setImages(images.filter((_, i) => i !== imageIndex))
              }
              style={style}
            >
              <Img
                width="100%"
                height="100%"
                src={image instanceof File ? URL.createObjectURL(image) : image.url}
                alt={image instanceof File ? image.name : image.url}
                className="rounded-md"
              />
            </div>
          </Tooltip.Floating>
        ))}
        {images.length < maxImages && (
          <div
            title={placeholder}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
            className={`flex-center cursor-pointer flex-col gap-2 rounded-lg border border-dashed text-gray-500 transition-colors hover:bg-gray-50 ${dragging ? "border-blue-300 bg-blue-50" : "border-gray-300"} ${className}`}
            style={style}
          >
            <input type="file" multiple ref={inputRef} accept={inputAccept} onChange={handleUpload} hidden />
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
      </div>

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
