import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";

export default function Loader() {
  const { language } = useLanguage();

  return (
    <div className="flex-center h-full flex-col gap-2">
      <span className="loader"></span>
      <p>{translate(language, "Generating...", "جاري التحميل...")}</p>
      <style>{`
        .loader {
          width: 48px;
          height: 48px;
          border: 3px dotted #CCC;
          border-style: solid solid dotted dotted;
          border-radius: 50%;
          display: inline-block;
          position: relative;
          box-sizing: border-box;
          animation: rotation 2s linear infinite;
        }
        .loader::after {
          content: '';  
          box-sizing: border-box;
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
          margin: auto;
          border: 3px dotted #FF3D00;
          border-style: solid solid dotted;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          animation: rotationBack 1s linear infinite;
          transform-origin: center center;
        }
            
        @keyframes rotation {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        } 
        @keyframes rotationBack {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(-360deg);
          }
        } 
    `}</style>
    </div>
  );
}
