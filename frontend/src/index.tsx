import ReactDOM from "react-dom/client";
import App from "./App.tsx";

import { GoogleOAuthProvider } from "@react-oauth/google";

import "@/index.css";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import { MantineProvider, localStorageColorSchemeManager } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import theme from "@/theme";

// Same localStorage key index.html's inline script reads synchronously before first paint (to
// avoid a light->dark flash) and the one Tailwind-side sync in useColorScheme.ts assumes.
const colorSchemeManager = localStorageColorSchemeManager({ key: "reversia-color-scheme" });

import RememberUser from "@/pages/routes/remeber-user.tsx";
import LanguageProvider from "@/context/LanguageContext.tsx";
import UserProvider from "@/context/UserContext.tsx";
import MainCategoriesProvider from "@/context/MainCategoriesContext.tsx";
import SubCategoriesProvider from "@/context/SubcategoriesContext.tsx";
import WarehousesProvider from "@/context/WarehousesContext.tsx";
import GovernorateProvider from "@/context/GovernorateContext.tsx";
import AboutProvider from "@/context/AboutContext.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <MantineProvider theme={theme} colorSchemeManager={colorSchemeManager} defaultColorScheme="auto">
    <Notifications />
    <LanguageProvider>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
        <UserProvider>
          <RememberUser>
            <MainCategoriesProvider>
              <SubCategoriesProvider>
                <GovernorateProvider>
                  <AboutProvider>
                    <WarehousesProvider>
                      <App />
                    </WarehousesProvider>
                  </AboutProvider>
                </GovernorateProvider>
              </SubCategoriesProvider>
            </MainCategoriesProvider>
          </RememberUser>
        </UserProvider>
      </GoogleOAuthProvider>
    </LanguageProvider>
  </MantineProvider>,
);
