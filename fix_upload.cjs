const fs = require('fs');
let code = fs.readFileSync('src/components/DocumentAnalyzerTab.tsx', 'utf-8');

const replacement = `  // Multiple File Uploader (Supports up to 15 concurrent slots)
  const handleMultipleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;

    const filesArray: File[] = Array.from(rawFiles);
      
    // Tiered Limits check
    const customFilesCount = organizedFiles.filter(f => !f.id.startsWith("preloaded-")).length;
    if (customFilesCount + filesArray.length > 20) {
      setCustomUploadError("You have reached the maximum allowed limit of 20 files.");
      e.target.value = "";
      return;
    }

    if (filesArray.length > 15) {
      setCustomUploadError("Bulk analyze limit: You can upload up to 15 concurrent files in a single batch for quick analyze. Please select fewer files to upload in this batch.");
      e.target.value = "";
      return;
    }

    setCustomUploadError("");
    setBulkProgress(\`Concurrently processing \${filesArray.length} files for speedy results...\`);

    const loadedFiles: OrganizedFile[] = await Promise.all(filesArray.map(async (f) => {
      let parsedContent = "";
      let finalName = f.name;
      let finalMimeType = f.type || "text/plain";
      const nameL = f.name.toLowerCase();

      let processedFile: File | Blob = f;
      const isHEIC = nameL.endsWith(".heic") || nameL.endsWith(".heif") || f.type === "image/heic" || f.type === "image/heif";

      if (isHEIC) {
        try {
          const heic2any = (await import("heic2any")).default;
          const convertedBlob = await heic2any({
            blob: f,
            toType: "image/jpeg",
            quality: 0.8
          });
          const singleBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
          processedFile = singleBlob;
          finalName = f.name.replace(/\\.(heic|heif)$/i, ".jpg");
          finalMimeType = "image/jpeg";
        } catch (err: any) {
          console.error("HEIC conversion failed:", err);
        }
      }

      const isAudio = finalMimeType.startsWith("audio/") || 
                      nameL.endsWith(".mp3") || 
                      nameL.endsWith(".wav") || 
                      nameL.endsWith(".m4a") || 
                      nameL.endsWith(".webm") || 
                      nameL.endsWith(".ogg");

      if (isAudio) {
        const audioBase64 = await new Promise<string>((resolve) => {
          const fileReader = new FileReader();
          fileReader.onload = () => {
            const raw = fileReader.result as string;
            resolve(raw.split(",")[1] || ""); // Base64 chunk
          };
          fileReader.readAsDataURL(processedFile);
        });

        try {
          const response = await apiFetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audioData: audioBase64,
              mimeType: f.type || "audio/wav",
              fileName: f.name
            })
          });

          const responseData = await safeReadJson(response);
          parsedContent = responseData.transcribedText;
          finalName = responseData.fileName;
          finalMimeType = "application/pdf"; // Stored in PDF format
        } catch (error: any) {
          console.error("Automated audio transcription failed:", error);
          parsedContent = \`IN THE ONTARIO FAMILY COURT OF JUSTICE\\n\\nRECORDING STATEMENT FOR: \${f.name}\\n\\n[SYSTEM TRANSCRIBING PIPE WARNING]: The automated transcription queue failed to reach the model. Falling back to parent raw audio metadata representation.\\nReason: \${error.message || error}\\nPencil notes: Please contact your legal advisor.\`;
          finalName = \`Transcript - \${f.name.replace(/\\.[^/.]+$/, "")}.pdf\`;
          finalMimeType = "application/pdf";
        }
      } else if (finalMimeType === "text/plain") {
        parsedContent = await new Promise<string>((resolve) => {
          const fileReader = new FileReader();
          fileReader.onload = () => resolve(fileReader.result as string || "");
          fileReader.readAsText(processedFile);
        });
      } else {
        parsedContent = await new Promise<string>((resolve) => {
          const fileReader = new FileReader();
          fileReader.onload = () => {
            const raw = fileReader.result as string;
            resolve(raw.split(",")[1] || ""); // Base64 chunk
          };
          fileReader.readAsDataURL(processedFile);
        });
      }

      // Quick folder auto-categorization engine based on matching names
      let categoryIndex: OrganizedFile["category"] = "Evidence & Loggers";
      if (!isAudio) {
        if (nameL.includes("cas") || nameL.includes("notice") || nameL.includes("letter") || nameL.includes("report") || nameL.includes("visit")) {
          categoryIndex = "CAS Correspondence";
        } else if (nameL.includes("court") || nameL.includes("brief") || nameL.includes("affidavit") || nameL.includes("motion") || nameL.includes("form") || nameL.includes("rule")) {
          categoryIndex = "Court Filings";
        } else if (nameL.includes("police") || nameL.includes("medical") || nameL.includes("school") || nameL.includes("therapy")) {
          categoryIndex = "Third-Party Professional Records";
        }
      } else {
        categoryIndex = "Evidence & Loggers";
      }

      return {
        id: "upload-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9),
        name: finalName,
        type: finalMimeType,
        size: processedFile.size,
        content: parsedContent,
        category: categoryIndex,
        uploadDate: new Date().toISOString(),
        analysisStatus: "unprocessed"
      };
    }));

    setOrganizedFiles(prev => [...prev, ...loadedFiles]);
    setBulkProgress(null);
    e.target.value = "";
  };`;

// replace from `const handleMultipleFilesUpload = async` to `e.target.value = "";\n  };`
const startRegex = /\/\/ Multiple File Uploader \(Supports up to 15 concurrent slots\)[\s\S]*?e\.target\.value = "";\n  \};/;
code = code.replace(startRegex, replacement);

fs.writeFileSync('src/components/DocumentAnalyzerTab.tsx', code);
