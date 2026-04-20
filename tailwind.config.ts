import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" }
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" }
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(30px)" },
          "100%": { opacity: "1", transform: "translateX(0)" }
        },
        "slide-up-fade": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "breathe": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.05)", opacity: "0.8" }
        },
        "ripple": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.5)", opacity: "0" }
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 20px hsl(var(--primary) / 0.3)" },
          "50%": { boxShadow: "0 0 30px hsl(var(--primary) / 0.5)" }
        },
        "breath-in": {
          "0%": { transform: "scale(0.8)", opacity: "0.5" },
          "50%": { transform: "scale(1.15)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" }
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.8" },
          "50%": { transform: "scale(1.2)", opacity: "0.4" },
          "100%": { transform: "scale(1)", opacity: "0.8" }
        },
      },
      typography: () => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': 'hsl(var(--foreground) / 0.9)',
            '--tw-prose-headings': 'hsl(var(--foreground))',
            '--tw-prose-lead': 'hsl(var(--foreground) / 0.8)',
            '--tw-prose-links': 'hsl(var(--primary))',
            '--tw-prose-bold': 'hsl(var(--foreground))',
            '--tw-prose-counters': 'hsl(var(--muted-foreground))',
            '--tw-prose-bullets': 'hsl(var(--muted-foreground) / 0.6)',
            '--tw-prose-hr': 'hsl(var(--border) / 0.5)',
            '--tw-prose-quotes': 'hsl(var(--foreground) / 0.85)',
            '--tw-prose-quote-borders': 'hsl(var(--primary) / 0.4)',
            '--tw-prose-captions': 'hsl(var(--muted-foreground))',
            '--tw-prose-code': 'hsl(var(--foreground))',
            '--tw-prose-pre-code': 'hsl(var(--foreground) / 0.9)',
            '--tw-prose-pre-bg': 'hsl(var(--muted) / 0.6)',
            '--tw-prose-th-borders': 'hsl(var(--border))',
            '--tw-prose-td-borders': 'hsl(var(--border) / 0.5)',
            '--tw-prose-invert-body': 'hsl(var(--foreground) / 0.9)',
            '--tw-prose-invert-headings': 'hsl(var(--foreground))',
            '--tw-prose-invert-links': 'hsl(var(--primary))',
            '--tw-prose-invert-bold': 'hsl(var(--foreground))',
            '--tw-prose-invert-quotes': 'hsl(var(--foreground) / 0.85)',
            '--tw-prose-invert-quote-borders': 'hsl(var(--primary) / 0.4)',
            '--tw-prose-invert-code': 'hsl(var(--foreground))',
            '--tw-prose-invert-pre-bg': 'hsl(var(--muted) / 0.4)',
            '--tw-prose-invert-th-borders': 'hsl(var(--border))',
            '--tw-prose-invert-td-borders': 'hsl(var(--border) / 0.5)',
            lineHeight: '1.7',
            h1: {
              fontSize: '1.5rem',
              fontWeight: '600',
              letterSpacing: '-0.02em',
              marginTop: '0',
              marginBottom: '0.75em',
              lineHeight: '1.25',
            },
            h2: {
              fontSize: '1.25rem',
              fontWeight: '600',
              letterSpacing: '-0.015em',
              marginTop: '1.75em',
              marginBottom: '0.6em',
              paddingBottom: '0.35em',
              borderBottom: '1px solid hsl(var(--border) / 0.4)',
              lineHeight: '1.3',
            },
            h3: {
              fontSize: '1.05rem',
              fontWeight: '500',
              marginTop: '1.4em',
              marginBottom: '0.5em',
              lineHeight: '1.4',
            },
            h4: {
              fontSize: '0.95rem',
              fontWeight: '600',
              marginTop: '1.2em',
              marginBottom: '0.4em',
            },
            p: { marginTop: '0.75em', marginBottom: '0.75em' },
            'ul > li::marker': { color: 'hsl(var(--muted-foreground) / 0.6)' },
            'ol > li::marker': { color: 'hsl(var(--muted-foreground))', fontWeight: '500' },
            blockquote: {
              fontStyle: 'italic',
              fontWeight: '400',
              borderLeftWidth: '3px',
              paddingLeft: '1em',
              color: 'hsl(var(--foreground) / 0.75)',
              quotes: 'none',
            },
            'blockquote p:first-of-type::before': { content: 'none' },
            'blockquote p:last-of-type::after': { content: 'none' },
            code: {
              backgroundColor: 'hsl(var(--muted) / 0.6)',
              padding: '0.15em 0.4em',
              borderRadius: '0.3rem',
              fontSize: '0.85em',
              fontWeight: '500',
            },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            pre: {
              borderRadius: '0.5rem',
              padding: '1em 1.15em',
              border: '1px solid hsl(var(--border) / 0.4)',
            },
            table: {
              fontSize: '0.9em',
              borderCollapse: 'collapse',
              width: '100%',
            },
            thead: {
              backgroundColor: 'hsl(var(--muted) / 0.3)',
              borderBottom: '1px solid hsl(var(--border))',
            },
            'thead th': {
              fontWeight: '600',
              padding: '0.6em 0.85em',
              textAlign: 'left',
            },
            'tbody td': {
              padding: '0.55em 0.85em',
              borderBottom: '1px solid hsl(var(--border) / 0.4)',
            },
            hr: {
              borderColor: 'hsl(var(--border) / 0.5)',
              marginTop: '2em',
              marginBottom: '2em',
            },
            a: {
              fontWeight: '500',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              textDecorationColor: 'hsl(var(--primary) / 0.4)',
            },
            'a:hover': { textDecorationColor: 'hsl(var(--primary))' },
            strong: { fontWeight: '600', color: 'hsl(var(--foreground))' },
          },
        },
      }),
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
        "scale-in": "scale-in 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-up": "slide-up 0.4s ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "slide-in-right": "slide-in-right 0.4s ease-out",
        "slide-up-fade": "slide-up-fade 0.5s ease-out",
        "breathe": "breathe 6s ease-in-out infinite",
        "ripple": "ripple 6s ease-out infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "breath-in": "breath-in 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
        "pulse-ring": "pulse-ring 1s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
