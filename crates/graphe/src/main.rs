//! Graphe desktop shell. Domain rules and module I/O stay out of this file.

fn main() {
    let startup = graphe::startup::build_startup_model();
    println!("{}", graphe::startup::describe_startup(&startup));
    if let Err(err) = graphe::run() {
        eprintln!("window: {err}");
        std::process::exit(0);
    }
}
