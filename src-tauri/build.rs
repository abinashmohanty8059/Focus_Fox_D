fn main() {
    println!("cargo:rerun-if-changed=../.env");
    tauri_build::build()
}
