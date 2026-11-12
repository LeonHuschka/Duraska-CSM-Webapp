import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			background: 'hsl(var(--background) / calc(var(--background-a, 1) * <alpha-value>))',
  			foreground: 'hsl(var(--foreground) / calc(var(--foreground-a, 1) * <alpha-value>))',
  			card: {
  				DEFAULT: 'hsl(var(--card) / calc(var(--card-a, 1) * <alpha-value>))',
  				foreground: 'hsl(var(--card-foreground) / calc(var(--card-foreground-a, 1) * <alpha-value>))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover) / calc(var(--popover-a, 1) * <alpha-value>))',
  				foreground: 'hsl(var(--popover-foreground) / calc(var(--popover-foreground-a, 1) * <alpha-value>))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary) / calc(var(--primary-a, 1) * <alpha-value>))',
  				foreground: 'hsl(var(--primary-foreground) / calc(var(--primary-foreground-a, 1) * <alpha-value>))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary) / calc(var(--secondary-a, 1) * <alpha-value>))',
  				foreground: 'hsl(var(--secondary-foreground) / calc(var(--secondary-foreground-a, 1) * <alpha-value>))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted) / calc(var(--muted-a, 1) * <alpha-value>))',
  				foreground: 'hsl(var(--muted-foreground) / calc(var(--muted-foreground-a, 1) * <alpha-value>))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent) / calc(var(--accent-a, 1) * <alpha-value>))',
  				foreground: 'hsl(var(--accent-foreground) / calc(var(--accent-foreground-a, 1) * <alpha-value>))'
  			},
  			destructive: 'hsl(var(--destructive) / calc(var(--destructive-a, 1) * <alpha-value>))',
  			border: 'hsl(var(--border) / calc(var(--border-a, 1) * <alpha-value>))',
  			input: 'hsl(var(--input) / calc(var(--input-a, 1) * <alpha-value>))',
  			ring: 'hsl(var(--ring) / calc(var(--ring-a, 1) * <alpha-value>))',
  			chart: {
  				'1': 'hsl(var(--chart-1) / calc(var(--chart-1-a, 1) * <alpha-value>))',
  				'2': 'hsl(var(--chart-2) / calc(var(--chart-2-a, 1) * <alpha-value>))',
  				'3': 'hsl(var(--chart-3) / calc(var(--chart-3-a, 1) * <alpha-value>))',
  				'4': 'hsl(var(--chart-4) / calc(var(--chart-4-a, 1) * <alpha-value>))',
  				'5': 'hsl(var(--chart-5) / calc(var(--chart-5-a, 1) * <alpha-value>))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar) / calc(var(--sidebar-a, 1) * <alpha-value>))',
  				foreground: 'hsl(var(--sidebar-foreground) / calc(var(--sidebar-foreground-a, 1) * <alpha-value>))',
  				primary: 'hsl(var(--sidebar-primary) / calc(var(--sidebar-primary-a, 1) * <alpha-value>))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground) / calc(var(--sidebar-primary-foreground-a, 1) * <alpha-value>))',
  				accent: 'hsl(var(--sidebar-accent) / calc(var(--sidebar-accent-a, 1) * <alpha-value>))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground) / calc(var(--sidebar-accent-foreground-a, 1) * <alpha-value>))',
  				border: 'hsl(var(--sidebar-border) / calc(var(--sidebar-border-a, 1) * <alpha-value>))',
  				ring: 'hsl(var(--sidebar-ring) / calc(var(--sidebar-ring-a, 1) * <alpha-value>))'
  			}
  		},
  		backdropBlur: {
  			glass: '22px'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
