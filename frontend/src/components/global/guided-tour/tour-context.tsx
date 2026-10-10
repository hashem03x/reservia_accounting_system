import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@mantine/core";
import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import Modal from "@/components/ui/modal";
import { isCustomer } from "@/utils/constants/roles";
import { stepsFor, TourStep } from "./tour-steps";
import TourOverlay from "./tour-overlay";

// Guided tour state. Per-user persistence lives on the server (PUT users/me/tour: completed /
// dismissed / reset - returned on the user record), so a finished or dismissed tour is not offered
// again on another browser or after logging in again. The current step survives a page refresh
// (sessionStorage, per user). The tour is kept out of business logic entirely.

type TourContextValue = { start: () => void; active: boolean };
const TourContext = createContext<TourContextValue>({ start: () => {}, active: false });
export const useTour = () => useContext(TourContext);

const stepKey = (userId: string) => `reservia-tour-step:${userId}`;
const offeredKey = (userId: string) => `reservia-tour-offered:${userId}`;
const storage = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* storage unavailable - the tour still works, it just won't survive a refresh */
    }
  },
  remove: (k: string) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export default function TourProvider({ children }: { children: ReactNode }) {
  const { user, setUser } = useUser();
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const steps: TourStep[] = useMemo(() => stepsFor(user), [user]);
  const [index, setIndex] = useState<number | null>(null);
  const [offerOpened, setOfferOpened] = useState(false);
  const userId = user?._id || "";

  // Resume after a refresh; offer the tour on the first visit (not finished / dismissed yet).
  useEffect(() => {
    if (!user || isCustomer(user.role)) return;
    const saved = storage.get(stepKey(user._id));
    if (saved !== null && Number(saved) < steps.length) {
      setIndex(Number(saved));
      return;
    }
    const seen = user.tour?.completedAt || user.tour?.dismissedAt;
    if (!seen && !storage.get(offeredKey(user._id))) setOfferOpened(true);
  }, [userId]);

  const record = useCallback(
    (status: "completed" | "dismissed" | "reset") => {
      privateRequest({ method: "PUT", url: "users/me/tour", data: { status }, language })
        .then((res) => setUser((prev) => (prev ? { ...prev, tour: res.data?.tour ?? prev.tour } : prev)))
        .catch(() => {
          /* the tour itself never depends on this call */
        });
    },
    [language],
  );

  const goTo = useCallback(
    (next: number | null) => {
      setIndex(next);
      if (!userId) return;
      if (next === null) storage.remove(stepKey(userId));
      else storage.set(stepKey(userId), String(next));
    },
    [userId],
  );

  const start = useCallback(() => {
    if (!userId) return;
    storage.set(offeredKey(userId), "1");
    setOfferOpened(false);
    goTo(0);
  }, [userId, goTo]);

  const exit = useCallback(
    (finished: boolean) => {
      goTo(null);
      record(finished ? "completed" : "dismissed");
    },
    [goTo, record],
  );

  // Follow the current step to its page.
  const step = index !== null ? steps[index] : null;
  useEffect(() => {
    if (step?.route && pathname.replace(/\/$/, "") !== step.route) navigate(step.route);
  }, [step?.id]);

  return (
    <TourContext.Provider value={{ start, active: index !== null }}>
      {children}
      {step && index !== null && (
        <TourOverlay
          step={step}
          index={index}
          total={steps.length}
          onBack={() => goTo(Math.max(0, index - 1))}
          onNext={() => (index + 1 < steps.length ? goTo(index + 1) : exit(true))}
          onClose={() => exit(false)}
        />
      )}
      <Modal
        opened={offerOpened}
        onClose={() => {
          setOfferOpened(false);
          if (userId) storage.set(offeredKey(userId), "1");
          record("dismissed");
        }}
        title={translate("Welcome to Reservia", "مرحباً بك في ريزرفيا")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {translate(
              'Would you like a short guided tour of the dashboard and its modules? You can restart it any time from "Make a tour" in the sidebar.',
              'هل تريد جولة إرشادية قصيرة في لوحة التحكم ووحداتها؟ يمكنك إعادتها في أي وقت من "Make a tour" في القائمة الجانبية.',
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="subtle"
              color="gray"
              onClick={() => {
                setOfferOpened(false);
                if (userId) storage.set(offeredKey(userId), "1");
                record("dismissed");
              }}
            >
              {translate("Skip", "تخطي")}
            </Button>
            <Button onClick={start}>{translate("Start the tour", "ابدأ الجولة")}</Button>
          </div>
        </div>
      </Modal>
    </TourContext.Provider>
  );
}
