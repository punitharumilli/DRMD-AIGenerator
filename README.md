# Digital Reference Material Document (DRMD) Generator

A modern, production-ready React application for automating the extraction and generation of ISO 33401:2024 compliant Digital Reference Material Documents (DRMDs) from legacy PDF certificates and product information sheets.

Powered by Google Gemini 2.5 Flash, this tool intelligently extracts data, structural properties, and measurement uncertainties directly from PDFs, and seamlessly exports them into highly compliant XML architectures.

## Key Features

- **Dual-Mode Architecture**: Natively supports both **Reference Material Certificates (CRM)** and **Product Information Sheets (PIS)**, dynamically adapting validation rules, XML schemas, and UI elements based on the detected document type.
- **AI-Powered Extraction**: Leverages Google Gemini 2.5 Vision to automatically extract nested administrative data, tables, and physical properties from unstructured documents.
- **Advanced Bulk Processing**: Process 100+ documents concurrently. Built with robust memory management, isolating Base64 streams to prevent Out-Of-Memory (OOM) browser crashes, and features a one-click ZIP export.
- **ISO 33401:2024 Schematron Validation**: A strict, real-time 3-Tier validation system (Errors 🔴, Conditional Errors 🟠, Warnings 🟡) ensuring exported XMLs are perfectly compliant with federal schema requirements before export.
- **Enterprise Resilience**: Includes exponential backoff for API rate-limiting (HTTP 429), React Error Boundaries to prevent UI crashes, and stringent sanitization of AI hallucinations.

---

## Architecture Overview

This is a fully client-side Single Page Application (SPA) built with:
- **React 18** (Vite Bundler)
- **TypeScript** for strict type safety
- **Tailwind CSS** for responsive styling
- **@google/genai** official SDK for LLM integration

### Key Modules:
- `services/llmService.ts`: Handles secure API communication, markdown sanitization, and automatic retry logic (exponential backoff) for API rate limits.
- `utils/xmlGenerator.ts`: Safely converts JavaScript state into validated DRMD v1.1.0 XML using rigorous defensive programming.
- `utils/validator.ts`: The central source of truth for the ISO Schematron business rules.
- `App.tsx`: Manages the application state, file input (with size/type validation), and UI rendering.

---

## Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/en/) (v18 or higher recommended)
- A valid Google Gemini API Key. *(Note: If this application is hosted publicly, you will need to enter your API key in the application's Settings tab, or the organization must deploy a backend proxy to secure a centralized key).*

### Quick Start

1. **Clone or Download the Repository**
2. **Install Dependencies**
   Navigate to the project root directory and run:
   ```bash
   npm install
   ```
3. **Start the Development Server**
   ```bash
   npm run dev
   ```
4. **Access the Application**
   Open your browser and navigate to `http://localhost:5173` (or the port specified by Vite in your terminal).

### Production Build
To create an optimized, minified bundle for production deployment:
```bash
npm run build
```
This will generate a `dist/` directory that can be statically hosted on any web server (Nginx, Apache, Vercel, Netlify, IIS, etc.).

---

## Usage Guide

1. **Configuration**: Upon first launch, navigate to the **Settings** tab and enter your Google Gemini API Key.
2. **Upload Document(s)**: 
   - Click **Upload PDF** for a single `.pdf`, `.doc`, or `.docx` file.
   - Click **Upload Folder** to process a directory of multiple files.
3. **Review & Edit**: The AI will extract the data. Review the **Administrative Data**, **Materials**, **Properties**, and **Statements** tabs. If you upload a Certificate, the system will enforce stricter validation (e.g., Metrological Traceability) than if you upload a Product Information Sheet.
4. **Validate & Export**: Navigate to the **Validate & Export** tab. Review the 3-Tier Validation Report. Once all red errors are resolved, click **Export XML** to download your compliant DRMD file.

---

## Production & Security Notes

- **File Limits**: Uploads are capped at **20MB per file** to protect browser memory and API payloads. Supported file types include `.pdf`, `.doc`, and `.docx`.
- **Client-Side Processing**: All parsing, processing, and XML generation occurs entirely in the user's browser. The only external network call is made directly to Google's Gemini API endpoints for data extraction.
- **Graceful Failure**: If the LLM generates a structurally invalid response or the schema engine fails, a global React Error Boundary will catch the exception, present a friendly error screen, and prevent the "white screen of death."
