import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ArrowLeft, CreditCard, Check } from "lucide-react";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    features: ["5 queries per day", "Basic agents", "Email support"],
    current: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    period: "per month",
    features: [
      "Unlimited queries",
      "All agents unlocked",
      "Priority support",
      "Custom integrations",
      "API access",
    ],
    current: false,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "contact us",
    features: [
      "Everything in Pro",
      "Dedicated support",
      "Custom agents",
      "SLA guarantee",
      "On-premise option",
    ],
    current: false,
  },
];

const Billing = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        navigate("/auth");
        return;
      }
      setIsLoading(false);
    };
    checkAuth();
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-neutral-100 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-neutral-600" />
          </button>
          <h1 className="text-lg font-medium text-neutral-800">Billing</h1>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Current Plan */}
        <div className="mb-8 p-6 bg-neutral-50 rounded-2xl">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-5 h-5 text-neutral-600" />
            <h2 className="font-medium text-neutral-800">Current Plan</h2>
          </div>
          <p className="text-2xl font-light text-neutral-900 mb-1">Free</p>
          <p className="text-sm text-neutral-500">
            You're on the free plan with limited features
          </p>
        </div>

        {/* Plans */}
        <h3 className="text-lg font-medium text-neutral-800 mb-4">Choose a plan</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "p-6 rounded-2xl border-2 transition-all",
                plan.current
                  ? "border-neutral-900 bg-neutral-50"
                  : "border-neutral-200 hover:border-neutral-300"
              )}
            >
              <h4 className="font-medium text-neutral-800 mb-1">{plan.name}</h4>
              <div className="mb-4">
                <span className="text-2xl font-light text-neutral-900">{plan.price}</span>
                <span className="text-sm text-neutral-500 ml-1">/{plan.period}</span>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-neutral-600">
                    <Check className="w-4 h-4 text-green-600" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                disabled={plan.current}
                className={cn(
                  "w-full py-2.5 rounded-full text-sm font-medium transition-colors",
                  plan.current
                    ? "bg-neutral-200 text-neutral-500 cursor-not-allowed"
                    : "bg-neutral-900 text-white hover:bg-neutral-800"
                )}
              >
                {plan.current ? "Current plan" : plan.id === "enterprise" ? "Contact sales" : "Upgrade"}
              </button>
            </div>
          ))}
        </div>

        {/* Payment Methods */}
        <div className="mt-12">
          <h3 className="text-lg font-medium text-neutral-800 mb-4">Payment methods</h3>
          <div className="p-6 border border-neutral-200 rounded-2xl text-center">
            <p className="text-neutral-500 mb-4">No payment methods added</p>
            <button
              className={cn(
                "px-6 py-2.5 rounded-full text-sm font-medium",
                "border border-neutral-200 text-neutral-700",
                "hover:bg-neutral-50 transition-colors"
              )}
            >
              Add payment method
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Billing;
