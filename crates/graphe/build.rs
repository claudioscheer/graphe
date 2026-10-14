fn main() {
    println!("cargo:rerun-if-changed=../../assets/graphe.ico");
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("../../assets/graphe.ico");
        if let Err(err) = res.compile() {
            eprintln!("Failed to compile Windows resource: {err}");
        }
    }
}
