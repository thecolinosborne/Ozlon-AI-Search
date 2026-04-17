import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { financeService } from "@/services/financeService";
import { handleError } from "@/lib/handleError";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  mode?: "create" | "update";
  itemId?: string;
  receivedRedirectUri?: string;
  onConnected?: () => void;
  className?: string;
  children: React.ReactNode;
}

const REDIRECT_PATH = "/finance/oauth-return";
const STORAGE_KEY = "plaid_link_token";

/**
 * Single Plaid Link entry. Stores the link_token in sessionStorage so that
 * if the institution uses OAuth and the browser is redirected away, the
 * OAuth return page can re-open Link with the same token.
 */
export const PlaidLinkButton = ({
  mode = "create",
  itemId,
  receivedRedirectUri,
  onConnected,
  className,
  children,
}: Props) => {
  const qc = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const autoOpened = useRef(false);

  const fetchToken = useCallback(async () => {
    setLoading(true);
    try {
      const redirect_uri = `${window.location.origin}${REDIRECT_PATH}`;
      const { link_token } = await financeService.createLinkToken({
        mode,
        item_id: itemId,
        redirect_uri,
      });
      sessionStorage.setItem(STORAGE_KEY, link_token);
      setLinkToken(link_token);
      return link_token;
    } catch (err) {
      handleError(err, "Could not start bank connection");
      return null;
    } finally {
      setLoading(false);
    }
  }, [mode, itemId]);

  // If we are returning from OAuth, immediately reuse stored token
  useEffect(() => {
    if (receivedRedirectUri) {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) setLinkToken(stored);
    }
  }, [receivedRedirectUri]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri,
    onSuccess: async (public_token, metadata) => {
      try {
        const result = await financeService.exchangePublicToken(public_token, metadata);
        sessionStorage.removeItem(STORAGE_KEY);
        toast.success(`${result.institution_name || "Account"} connected`);
        // Kick off first transactions sync in background
        financeService.syncTransactions(result.item_id).catch(() => {});
        await qc.invalidateQueries({ queryKey: ["plaid"] });
        onConnected?.();
      } catch (err) {
        handleError(err, "Could not finish connecting your bank");
      }
    },
    onExit: (err) => {
      if (err) console.warn("[plaid] link exit", err);
      sessionStorage.removeItem(STORAGE_KEY);
    },
  });

  // Auto-open when arriving from OAuth redirect with a ready token
  useEffect(() => {
    if (receivedRedirectUri && ready && linkToken && !autoOpened.current) {
      autoOpened.current = true;
      open();
    }
  }, [receivedRedirectUri, ready, linkToken, open]);

  const handleClick = async () => {
    if (linkToken && ready) {
      open();
      return;
    }
    const t = await fetchToken();
    if (t) {
      // ready will flip true on next render; open in microtask
      setTimeout(() => open(), 0);
    }
  };

  return (
    <button onClick={handleClick} disabled={loading} className={className}>
      {loading ? "Preparing…" : children}
    </button>
  );
};
