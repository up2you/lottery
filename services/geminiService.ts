import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptScanResult } from "../types";

const parseReceiptImage = async (base64Image: string): Promise<ReceiptScanResult | null> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API Key not found");
    throw new Error("API Key missing");
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
            {
                inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Image
                }
            },
            {
                text: "Analyze this image of a Taiwan Uniform Invoice (receipt). Extract the 8-digit invoice number. If the image contains multiple receipts, identify the clearest one. Return ONLY the 8-digit number."
            }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            invoiceNumber: {
              type: Type.STRING,
              description: "The 8-digit invoice number extracted from the receipt.",
            },
            period: {
                type: Type.STRING,
                description: "The period string if visible (e.g. 113年01-02月), otherwise null.",
                nullable: true
            }
          },
          required: ["invoiceNumber"],
        },
      },
    });

    const text = response.text;
    if (!text) return null;

    const data = JSON.parse(text);
    
    // Basic validation cleanup
    const cleanNumber = data.invoiceNumber.replace(/\D/g, '');

    if (cleanNumber.length >= 8) {
        // Take the last 8 digits if somehow it grabbed more
        return {
            number: cleanNumber.slice(-8),
            period: data.period
        };
    }
    
    return null;

  } catch (error) {
    console.error("Gemini OCR Error:", error);
    return null;
  }
};

export const geminiService = {
  parseReceiptImage
};
