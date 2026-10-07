import { Skeleton } from "@mantine/core";
import { useState } from "react";

type Props = {
  src: string;
  alt: string;
  aspectRatio?: string;
  className?: string;
  style?: React.CSSProperties;
  width?: string;
  height?: string;
  onClick?: () => void;
};

export default function Img({
  src,
  alt,
  aspectRatio = "1/1",
  className = "",
  style = {},
  width = "",
  height = "",
  onClick,
}: Props) {
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div
      className={`relative w-fit overflow-hidden ${className}`}
      style={{ ...style, width, height, aspectRatio }}
      onClick={onClick}
    >
      {!imageLoaded && <Skeleton h="100%" w="100%" radius={0} />}
      <img
        key={src} // Force remounting when src changes
        src={src}
        alt={alt}
        loading="lazy"
        className={`block h-full w-full object-cover transition-opacity ${imageLoaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setImageLoaded(true)}
      />
    </div>
  );
}
