/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'IBM Plex Sans'", "sans-serif"]
      },
      colors: {
        ink: "#0c0d12",
        paper: "#f8f4ee",
        accent: "#ff6a3d",
        accent2: "#3d5afe",
        teal: "#18a999"
      },
      boxShadow: {
        soft: "0 20px 50px -20px rgba(12, 13, 18, 0.25)"
      },
      backgroundImage: {
        "mesh": "radial-gradient(circle at 20% 20%, rgba(255,106,61,0.18), transparent 45%), radial-gradient(circle at 80% 10%, rgba(61,90,254,0.18), transparent 40%), radial-gradient(circle at 50% 80%, rgba(24,169,153,0.18), transparent 45%)"
      }
    }
  },
  plugins: []
};
