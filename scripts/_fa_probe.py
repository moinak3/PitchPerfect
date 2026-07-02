import modal, inspect
image = (modal.Image.debian_slim(python_version="3.11").pip_install("torch>=2.0.0", "torchaudio<2.6"))
app = modal.App("fa-probe", image=image)


@app.function(gpu="A10G")
def probe():
    import torch, torchaudio
    import torchaudio.functional as F
    b = torchaudio.pipelines.MMS_FA
    return {
        "torch": torch.__version__, "torchaudio": torchaudio.__version__,
        "forced_align": hasattr(F, "forced_align"), "merge_tokens": hasattr(F, "merge_tokens"),
        "MMS_FA": hasattr(torchaudio.pipelines, "MMS_FA"), "sr": b.sample_rate,
        "get_model_sig": str(inspect.signature(b.get_model)),
        "get_dict_sig": str(inspect.signature(b.get_dict)),
        "dict_sample": dict(list(b.get_dict().items())[:8]), "dict_len": len(b.get_dict()),
    }


@app.local_entrypoint()
def main():
    print("PROBE_RESULT:", probe.remote())
