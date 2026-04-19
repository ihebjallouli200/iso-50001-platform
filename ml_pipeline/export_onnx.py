"""Convert PyTorch model to ONNX format for lightweight deployment."""
import torch, json, os, sys, numpy as np

sys.path.insert(0, "ml_pipeline")
os.environ["PYTHONIOENCODING"] = "utf-8"

# Load pointer
with open("ml_pipeline/models/anomaly_sequential/selected_latest.json") as f:
    pointer = json.load(f)
artifact_dir = pointer["artifact_dir"]
with open(os.path.join(artifact_dir, "metadata.json")) as f:
    metadata = json.load(f)

# Build model
from serve_anomaly_inference import TransformerClassifier
input_dim = len(metadata["features"])
model = TransformerClassifier(input_dim=input_dim)
state_dict = torch.load(os.path.join(artifact_dir, "model.pt"), map_location="cpu", weights_only=True)
model.load_state_dict(state_dict)
model.eval()

# Export ONNX (use legacy export to avoid encoding issues)
seq_len = metadata["sequence"]["seq_len"]
dummy = torch.randn(1, seq_len, input_dim)
onnx_path = os.path.join(artifact_dir, "model.onnx")

torch.onnx.export(
    model, dummy, onnx_path,
    input_names=["input"], output_names=["logits"],
    dynamic_axes={"input": {0: "batch"}},
    opset_version=14,
    dynamo=False,  # use legacy exporter
)
size_kb = os.path.getsize(onnx_path) / 1024
print(f"Exported: {onnx_path} ({size_kb:.1f} KB)")

# Verify with onnxruntime
try:
    import onnxruntime as ort
    sess = ort.InferenceSession(onnx_path)
    onnx_out = sess.run(None, {"input": dummy.numpy()})[0][0]
    torch_out = model(dummy).detach().numpy()[0]
    print(f"ONNX:  {onnx_out:.6f}")
    print(f"Torch: {torch_out:.6f}")
    print(f"Match: {abs(onnx_out - torch_out) < 0.001}")
except ImportError:
    print("onnxruntime not installed, skipping verification")
