/// <reference types="cypress" />
function searchBooks(term: string) {
  cy.get("[data-cy=rental_input_searchbook]")
    .clear()
    .type(term)
    .type("{enter}");
}

describe("Batch scan book import", () => {
  before(() => {
    cy.resetAndSeed();
  });

  after(() => {
    cy.clearDatabase();
  });

  beforeEach(() => {
    cy.session("user-session", () => {
      cy.login();
    });
    cy.visit("/");
  });

  it("should batch scan multiple books with quantity controls and import them", () => {
    cy.visit("/book/batchscan");
    cy.get("[data-cy=batch-scan-isbn-input]").should("be.visible");

    const isbnHerrDerRinge = "978-3-608-93828-9";
    cy.get("[data-cy=batch-scan-isbn-input]").type(isbnHerrDerRinge);
    cy.get("[data-cy=batch-scan-add-button]").click();

    cy.get("[data-cy=batch-scan-entry]", { timeout: 15000 })
      .first()
      .should("be.visible");
    cy.contains("Suche in Datenbank", { timeout: 15000 }).should("not.exist");
    cy.get("[data-cy=batch-scan-entry]")
      .first()
      .should("contain.text", "Ringe");

    const isbnHerrDerFliegen = "978-3-596-90667-3";
    cy.get("[data-cy=batch-scan-isbn-input]").type(isbnHerrDerFliegen);
    cy.get("[data-cy=batch-scan-add-button]").click();

    cy.get("[data-cy=batch-scan-entry]", { timeout: 15000 }).should(
      "have.length",
      2,
    );
    cy.contains("Suche in Datenbank", { timeout: 15000 }).should("not.exist");
    cy.get("[data-cy=batch-scan-entry]").should("contain.text", "Fliegen");

    // Scan Herr der Ringe again — counter should increase to 2
    cy.get("[data-cy=batch-scan-isbn-input]").type(isbnHerrDerRinge);
    cy.get("[data-cy=batch-scan-add-button]").click();
    cy.get("[data-cy=batch-scan-entry]").should("have.length", 2);

    cy.get("[data-cy=batch-scan-entry]")
      .contains("Ringe")
      .parents("[data-cy=batch-scan-entry]")
      .should("contain.text", "2")
      .and("contain.text", "Exemplare");

    // Increase Herr der Fliegen counter to 3
    cy.get("[data-cy=batch-scan-entry]")
      .contains("Fliegen")
      .parents("[data-cy=batch-scan-entry]")
      .within(() => {
        cy.get("[data-cy=quantity-increment]").click();
        cy.get("[data-cy=quantity-increment]").click();
      });

    cy.get("[data-cy=batch-scan-entry]")
      .contains("Fliegen")
      .parents("[data-cy=batch-scan-entry]")
      .should("contain.text", "3")
      .and("contain.text", "Exemplare");

    cy.get("[data-cy=batch-scan-import-button]").should("contain.text", "5");
    cy.get("[data-cy=batch-scan-import-button]").click();

    cy.contains("erfolgreich importiert", { timeout: 30000 }).should(
      "be.visible",
    );

    // Verify books in the book list
    cy.visit("/");
    cy.get("[data-cy=index_book_button]").click();
    cy.url().should("include", "/book");
    cy.get("[data-cy=rental_input_searchbook]").should("be.visible");

    // Copies of a title share one card, which says how many there are.
    searchBooks("Ringe");
    cy.contains("[data-cy=book_card_copycount]", "2 Exemplare", {
      timeout: 10000,
    }).should("be.visible");

    searchBooks("Fliegen");
    cy.contains("[data-cy=book_card_copycount]", "3 Exemplare", {
      timeout: 10000,
    }).should("be.visible");

    searchBooks("Herr");
    cy.get("[data-cy=book_card_copycount]", { timeout: 10000 }).should(
      "have.length.at.least",
      2,
    );
  });
});
