/// <reference types="cypress" />
describe("List of books", () => {
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

  it("should navigate to the book screen", () => {
    cy.visit("/");
    cy.get("[data-cy=index_book_button]").click();
    cy.get("[data-cy=rental_input_searchbook]").should("be.visible");
  });

  it("should show the searched term again after going back", () => {
    cy.visit("/book");
    cy.get("[data-cy=rental_input_searchbook]").type("Emma").type("{enter}");
    cy.get("[data-cy=book_title]").should("have.length", 1);
    cy.get("[data-cy=rental_input_searchbook]")
      .type("{selectall}Cypress")
      .type("{enter}");
    cy.get("[data-cy=book_title]").should("have.length.at.least", 2);

    cy.go("back");
    cy.location("search").should("include", "q=Emma");
    cy.get("[data-cy=rental_input_searchbook]").should("have.value", "Emma");
  });
});
