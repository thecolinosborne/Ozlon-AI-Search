import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PlaidLinkButton } from "@/components/finance/PlaidLinkButton";

/**
 * Plaid OAuth return page. The institution redirects the user back here
 * after authentication. We re-open Plaid Link with the original link_token
 * (saved in sessionStorage) and `receivedRedirectUri = window.location.href`
 * so Link can complete the handshake. After success we navigate to /finance.
 */
const PlaidOAuthReturn = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Safety: if no link token was saved, bounce back to finance
    if (!sessionStorage.getItem("plaid_link_token")) {
      navigate("/finance", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-6">
        <div className="w-10 h-10 mx-auto rounded-full border-2 border-foreground/20 border-t-foreground animate-spin" />
        <div className="text-sm text-muted-foreground">Finishing connection…</div>
        {/* Hidden launcher: auto-opens Link with receivedRedirectUri */}
        <PlaidLinkButton
          receivedRedirectUri={window.location.href}
          onConnected={() => navigate("/finance", { replace: true })}
          className="sr-only"
        >
          Continue
        </PlaidLinkButton>
      </div>
    </div>
  );
};

export default PlaidOAuthReturn;
