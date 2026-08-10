import { useState } from "react";
import { AssetDashboard } from "./components/AssetDashboard";
import { ManageAsset } from "./components/ManageAsset";
import { Analytics } from "./components/Analytics";
import { AdminSettings } from "./components/AdminSettings";
import { CsvViewer } from "./components/CsvViewer";
import { HardResetDatabase } from "./components/HardResetDatabase";
import { AboutImageManager } from "./components/AboutImageManager";
import { BackupRestore } from "./components/BackupRestore";
import { ManualInput } from "./components/ManualInput";
import { SharedSidebar, type AdminTab } from "./components/SharedSidebar";
import { SuperuserLoginModal } from "./components/SuperuserLoginModal";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { Alert, AlertDescription } from "./components/ui/alert";
import { AlertTriangle } from "./components/icons";
import { useAssetData } from "./components/hooks/useAssetData";
import { UploadJobProvider } from "./context/UploadJobContext";
import { SuperuserProvider, useSuperuser } from "./context/SuperuserContext";
import { UploadJobWidget } from "./components/UploadJobWidget";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster } from "./components/ui/sonner";

type ViewType = "dashboard" | "superuser";

const ADMIN_TAB_TITLES: Record<AdminTab, string> = {
  manage: "Manage Asset",
  analytics: "Analytics",
  "csv-viewer": "Upload CSV",
  "manual-input": "Manual Input",
  backup: "Backup & Restore",
  "hard-reset": "Hard Reset Database",
  settings: "Settings",
  "about-image": "About Image",
};

function AppShell() {
  const [currentView, setCurrentView] = useState<ViewType>("dashboard");
  const [activeTab, setActiveTab] = useState<AdminTab>("csv-viewer");
  const { unlocked, secondsLeft } = useSuperuser();

  const goToDashboard = () => setCurrentView("dashboard");

  // Losing the session while the Superuser screens are open drops you back to
  // the dashboard rather than leaving admin tooling on screen behind a lock
  // that has already expired.
  if (currentView === "superuser" && !unlocked) {
    return <SuperuserScreens.Locked onDismiss={goToDashboard} />;
  }

  if (currentView === "superuser") {
    return (
      <>
        {/* Any click or keypress extends the session, so there's no separate
            "stay signed in" control to dismiss this. */}
        {secondsLeft !== null && (
          <div className="fixed left-1/2 top-4 z-[80] -translate-x-1/2">
            <Alert className="w-[360px] border-[var(--pp-stroke-alert)] bg-[var(--pp-bg-red-low)] shadow-lg">
              <AlertTriangle className="size-4 text-[var(--pp-icon-alert)]" />
              <AlertDescription className="text-[var(--pp-text-alert)]">
                <p className="font-bold">Session locking in {secondsLeft}s</p>
                <p className="text-xs">Move the mouse or press a key to stay signed in.</p>
              </AlertDescription>
            </Alert>
          </div>
        )}

        <SuperuserScreens
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onNavigateBack={goToDashboard}
        />
      </>
    );
  }

  return <AssetDashboard onNavigateToAssetManagement={() => setCurrentView("superuser")} />;
}

interface SuperuserScreensProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onNavigateBack: () => void;
}

function SuperuserScreens({ activeTab, onTabChange, onNavigateBack }: SuperuserScreensProps) {
  // Sidebar counts only; the admin screens load their own data.
  const { assets, assetCounts, loading, error, dataSource, handleRefresh } = useAssetData();

  return (
    <SidebarProvider>
      {/* Same shell as the dashboard: the page is the sunken surface and the
          admin screens sit on it as a floating white panel, padded on three
          sides so it butts up against the sidebar. */}
      <div className="flex h-screen w-full bg-[var(--pp-bg-sunken)]">
        <SharedSidebar
          mode="admin"
          activeAdminTab={activeTab}
          onAdminTabChange={onTabChange}
          onNavigateBack={onNavigateBack}
          showBackButton
          onCategoryClick={() => {}}
          assetCounts={assetCounts}
          assets={assets}
          loading={loading}
          error={error}
          dataSource={dataSource}
          handleRefresh={handleRefresh}
        />

        <div className="flex min-w-0 flex-1 flex-col py-3 pr-3 [filter:drop-shadow(var(--gili-panel-shadow))]">
          <div className="flex min-h-px flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <header className="flex w-full shrink-0 items-start gap-1 px-6 pb-4 pt-6">
              {/* Only reachable control for the off-canvas sidebar on mobile. */}
              <SidebarTrigger className="mr-1 size-9 shrink-0 lg:hidden" />
              <h1 className="pp-h3 min-w-0 truncate text-foreground">
                {ADMIN_TAB_TITLES[activeTab]}
              </h1>
            </header>

            <div className="h-px w-full shrink-0 bg-[var(--pp-stroke-disabled)]" />

            {/*
              Plain switch rather than <Tabs>. The tab bar was removed in 1.x when
              navigation moved into the sidebar, which left Radix Tabs rendering
              every panel and hiding all but one — so all eight admin screens
              mounted and ran their effects on every visit.
            */}
            <div className="min-h-px flex-1 overflow-y-auto">
              {activeTab === "manage" && <ManageAsset />}
              {activeTab === "analytics" && <Analytics />}
              {activeTab === "csv-viewer" && <CsvViewer />}
              {activeTab === "manual-input" && <ManualInput />}
              {activeTab === "backup" && <BackupRestore />}
              {activeTab === "hard-reset" && <HardResetDatabase />}
              {activeTab === "settings" && <AdminSettings />}
              {activeTab === "about-image" && <AboutImageManager />}
            </div>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

/**
 * Shown when the Superuser view is reached without an unlocked session — either
 * because it expired mid-session, or the tab was reloaded on that screen.
 */
SuperuserScreens.Locked = function Locked({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <SuperuserLoginModal isOpen onClose={onDismiss} />
    </div>
  );
};

/**
 * UploadJobProvider sits ABOVE the dashboard/superuser view switch on purpose:
 * a running CSV import must survive navigating back to the dashboard. If it
 * lived inside CsvViewer it would be torn down the moment that view unmounted
 * and the import would have to restart from row 0.
 *
 * SuperuserProvider is inside it because the session holds itself open while an
 * import is in flight, so it needs to read the job status.
 *
 * UploadJobWidget is rendered here too so import progress and pause/resume are
 * reachable from every screen, not just the Upload CSV screen.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <UploadJobProvider>
        <SuperuserProvider>
          <AppShell />
          <UploadJobWidget />
          {/* Mounted once, at the root. Without this every toast() call in the
              app is a no-op. */}
          <Toaster />
        </SuperuserProvider>
      </UploadJobProvider>
    </ErrorBoundary>
  );
}
