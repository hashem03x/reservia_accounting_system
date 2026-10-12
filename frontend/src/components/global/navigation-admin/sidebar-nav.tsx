import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { navIcons } from "@/components/icons";
import { NavItem, NavSection, activeItemKey, useAdminNavigation } from "./nav-config";

// The sidebar's navigation body, shared by the desktop sidebar (expanded or as an icon rail) and the
// mobile drawer. Sections open and close; the one holding the current page always opens when the
// page changes, and every section's state is remembered on this device.

const SECTIONS_KEY = "sidebar-sections";
const ALWAYS_OPEN_BY_DEFAULT = new Set(["overview"]);

function readSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

const itemBase =
  "group relative flex items-center rounded-md outline-none transition-colors duration-100 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-[#161b22]";
const itemIdle =
  "text-gray-600 hover:bg-gray-50 hover:text-gray-800 dark:text-[#a8b3bd] dark:hover:bg-white/5 dark:hover:text-white";
const itemActive = "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-500/15 dark:text-white";

function ActiveBar() {
  // A bar on the reading-start edge: the selected page is marked by shape and weight, not only color.
  return (
    <span aria-hidden className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-secondary-600 dark:bg-secondary-400" />
  );
}

function ItemLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { translate } = useLanguage();
  const link = (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={`${itemBase} ${active ? itemActive : itemIdle} ${collapsed ? "mx-auto h-10 w-10 justify-center" : "h-9 gap-3 pe-2 ps-3 text-[13.5px]"}`}
    >
      {active && <ActiveBar />}
      <item.Icon
        size={18}
        className={`shrink-0 ${active ? "text-primary-600 dark:text-primary-200" : "text-gray-500 group-hover:text-gray-700 dark:text-[#8b97a3] dark:group-hover:text-white"}`}
        aria-hidden
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  // Rendered in a portal (Mantine's default), so the tooltip is never clipped by the sidebar.
  return (
    <Tooltip
      label={item.label}
      position={translate("right", "left") as "right" | "left"}
      withArrow
      offset={10}
      openDelay={80}
    >
      {link}
    </Tooltip>
  );
}

export default function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { translations, translate } = useLanguage();
  const { nav } = translations;
  const sections = useAdminNavigation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeKey = activeItemKey(sections, pathname);
  const activeSection = sections.find((s) => s.items.some((i) => i.key === activeKey))?.key ?? null;
  const baseId = useId();
  const navRef = useRef<HTMLElement>(null);

  // Keep the current page in view (a long menu, or the icon rail on a short screen).
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [activeKey, collapsed]);

  const [open, setOpen] = useState<Record<string, boolean>>(readSections);
  const isOpen = (key: string) => open[key] ?? (ALWAYS_OPEN_BY_DEFAULT.has(key) || key === activeSection);
  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !isOpen(key) }));

  // Navigating into a closed section (direct URL, back / forward, a link on a page) opens it.
  useEffect(() => {
    if (activeSection && open[activeSection] === false) setOpen((prev) => ({ ...prev, [activeSection]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);
  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(open));
    } catch {
      // Storage unavailable (private mode) - sections simply are not remembered.
    }
  }, [open]);

  // Quick find (expanded only): filters every page by name across all sections.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered: NavSection[] = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return sections;
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((i) => i.label.toLocaleLowerCase().includes(q) || s.title.toLocaleLowerCase().includes(q)),
      }))
      .filter((s) => s.items.length);
  }, [sections, query]);
  const searching = query.trim().length > 0;

  if (collapsed) {
    return (
      <nav ref={navRef} aria-label={nav.mainNavigation} className="flex flex-col gap-1 px-2 py-3">
        {sections.map((section, index) => (
          <div key={section.key} className="flex flex-col gap-1">
            {index > 0 && <div aria-hidden className="mx-3 my-1.5 border-t border-gray-100 dark:border-[#2a323c]" />}
            <span className="sr-only">{section.title}</span>
            {section.items.map((item) => (
              <ItemLink key={item.key} item={item} active={item.key === activeKey} collapsed onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav ref={navRef} aria-label={nav.mainNavigation} className="flex flex-col px-3 pb-3">
      <div className="sticky top-0 z-[1] -mx-3 bg-white px-3 pb-2 pt-3 dark:bg-[#161b22]">
        <div className="relative">
          <navIcons.Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && filtered[0]?.items[0]) {
                navigate(filtered[0].items[0].to);
                setQuery("");
                onNavigate?.();
              }
            }}
            placeholder={nav.findPage}
            aria-label={nav.findPage}
            className="h-8 w-full rounded-md border border-gray-100 bg-gray-50 pe-7 ps-8 text-[13px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-primary-300 focus:bg-white focus:ring-2 focus:ring-primary-100 dark:border-[#2a323c] dark:bg-[#11151a] dark:text-[#e6e9ec] dark:focus:border-primary-500 dark:focus:ring-primary-500/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {searching && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label={nav.clearSearch}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 outline-none hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-primary-400 dark:hover:text-white"
            >
              <navIcons.Close size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-gray-500">{nav.noMatches}</p>}

      {filtered.map((section) => {
        const expanded = searching || isOpen(section.key);
        const listId = `${baseId}-${section.key}`;
        const holdsActive = section.key === activeSection;
        return (
          <div key={section.key} className="mt-2 first:mt-0">
            <button
              type="button"
              onClick={() => toggle(section.key)}
              disabled={searching}
              aria-expanded={expanded}
              aria-controls={listId}
              className={`flex h-7 w-full items-center gap-2 rounded px-3 text-start text-[11px] font-semibold text-gray-500 outline-none hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-default disabled:hover:text-gray-500 dark:text-[#8b97a3] dark:hover:text-white ${translate("uppercase tracking-[0.06em]", "")}`}
            >
              <span className="flex-1 truncate">{section.title}</span>
              {/* The section holding the current page is marked while it is closed. */}
              {holdsActive && !expanded && (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-secondary-600 dark:bg-secondary-400" />
              )}
              {!searching && (
                <navIcons.Chevron
                  size={14}
                  aria-hidden
                  className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${expanded ? "" : translate("-rotate-90", "rotate-90")}`}
                />
              )}
            </button>
            <ul id={listId} className={expanded ? "mt-0.5 flex flex-col gap-0.5" : "hidden"}>
              {section.items.map((item) => (
                <li key={item.key}>
                  <ItemLink item={item} active={item.key === activeKey} collapsed={false} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
